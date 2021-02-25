import 'module-alias/register';
import * as vscode from 'vscode';

import { uriHandler, CodingServer } from 'src/codingServer';
import { Panel } from 'src/panel';
import { IFileNode, MRTreeDataProvider } from 'src/tree/mrTree';
import { ReleaseTreeDataProvider } from 'src/tree/releaseTree';
import { IRepoInfo, IMRWebViewDetail, ISessionData } from 'src/typings/commonTypes';
import { GitService } from 'src/common/gitService';
import { ReviewComment, replyNote } from './reviewCommentController';
import { MRUriScheme } from 'src/common/contants';
import { IDiffComment, IMRData } from 'src/typings/respResult';

export async function activate(context: vscode.ExtensionContext) {
  await GitService.init();
  const repoInfo = await CodingServer.getRepoParams();
  const hasRepo = !!repoInfo?.repo;
  await vscode.commands.executeCommand('setContext', 'hasRepo', hasRepo);
  await context.workspaceState.update(`repoInfo`, repoInfo);

  const codingSrv = new CodingServer(context);
  await codingSrv.initialize();

  if (!codingSrv.session?.user) {
    vscode.window.showWarningMessage(`Please login first.`);
  } else {
    await context.workspaceState.update(`session`, codingSrv.session);
    const rInfo = context.workspaceState.get(`repoInfo`, {});
    if (repoInfo?.repo) {
      await context.workspaceState.update(`repoInfo`, {
        ...rInfo,
        team: codingSrv.session.user.team,
      });
    }
  }

  const mrDataProvider = new MRTreeDataProvider(context, codingSrv);
  const releaseDataProvider = new ReleaseTreeDataProvider(context);
  const mrTree = vscode.window.createTreeView(`mrTreeView`, {
    treeDataProvider: mrDataProvider,
    showCollapseAll: true,
  });
  vscode.window.createTreeView(`releaseTreeView`, {
    treeDataProvider: releaseDataProvider,
    showCollapseAll: true,
  });

  const commentController = vscode.comments.createCommentController(
    'mr-comment',
    'Merge request diff comments',
  );
  context.subscriptions.push(commentController);

  commentController.commentingRangeProvider = {
    provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
      if (document.uri.scheme !== MRUriScheme) {
        return;
      }

      const lineCount = document.lineCount;
      return [new vscode.Range(0, 0, lineCount - 1, 0)];
    },
  };

  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));
  context.subscriptions.push(
    vscode.commands.registerCommand('codingPlugin.showMROverview', async (mr: IMRWebViewDetail) => {
      Panel.createOrShow(context, codingSrv);
      Panel.currentPanel?.broadcast(`mr.update.toggleLoading`, {});
      codingSrv.getMRDetail(mr.iid).then((detailResp) => {
        Panel.currentPanel?.broadcast(`mr.update`, {
          ...mr,
          data: {
            ...detailResp.data,
            loading: false,
          },
          user: context.workspaceState.get(`session`, {} as ISessionData)?.user,
        });
      });
      codingSrv.getMRActivities(mr.iid).then((activityResp) => {
        Panel.currentPanel?.broadcast(`mr.activities.init`, activityResp.data);
      });
      codingSrv.getMRReviewers(mr.iid).then((reviewerResp) => {
        Panel.currentPanel?.broadcast(`mr.reviewers.init`, reviewerResp.data);
      });
      codingSrv.getMRComments(mr.iid).then((commentResp) => {
        Panel.currentPanel?.broadcast(`mr.update.comments`, commentResp.data);
      });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codingPlugin.login', async () => {
      const rInfo = context.workspaceState.get(`repoInfo`, {}) as IRepoInfo;
      const session = await codingSrv.login(rInfo?.team || ``);
      if (!session?.accessToken) {
        console.error(`No token provided.`);
      } else {
        mrDataProvider.refresh();
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codingPlugin.logout', async () => {
      try {
        await codingSrv.logout();
        vscode.window.showInformationMessage(`Logout successfully.`);
      } finally {
        mrDataProvider.refresh();
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codingPlugin.refresh', () => {
      mrDataProvider.refresh();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codingPlugin.newMrDesc', async () => {
      const doc = await vscode.workspace.openTextDocument({
        language: `markdown`,
      });
      await vscode.window.showTextDocument(doc);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codingPlugin.createMr', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      let content = editor.document.getText().trimStart();
      if (!content) {
        return;
      }

      const firstLineBreak = content.indexOf(`\n`);
      const defaultTitle = content.slice(0, firstLineBreak).trim();

      const { data } = await codingSrv.getBranchList();
      const list = data.map((i) => ({
        label: i.name,
        description: ``,
      }));

      const src = await vscode.window.showQuickPick(list, {
        placeHolder: `Please choose source branch`,
      });
      if (!src) return;

      const des = await vscode.window.showQuickPick(list, {
        placeHolder: `Please choose target branch`,
      });
      if (!des) return;

      const title = await vscode.window.showInputBox({
        placeHolder: `By default it's the first line of this document.`,
        prompt: `Please input title for this merge request.`,
        value: defaultTitle,
      });
      if (!title) {
        return;
      }
      if (title === defaultTitle) {
        content = content.slice(firstLineBreak + 1).trimStart() || ``;
      }

      try {
        const newMr = await codingSrv.createMR({
          content,
          title,
          srcBranch: src.label,
          desBranch: des.label,
        });
        vscode.window.showInformationMessage(
          `Merge request ${newMr.data.merge_request.title} was created successfully.`,
        );
        mrDataProvider.refresh();
      } catch (err) {}
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codingPlugin.switchRepo', async () => {
      try {
        const { data } = await codingSrv.getRepoList();
        const list = data.map((i) => ({
          label: i.name,
          description: i.depotPath.replace(`/p/`, ``).replace(`/d/`, `/`).replace(`/git`, ``),
        }));
        const selection = await vscode.window.showQuickPick(list);
        if (!selection) return;

        const r = context.workspaceState.get(`repoInfo`, {}) as IRepoInfo;
        await context.workspaceState.update(`repoInfo`, {
          team: r?.team,
          project: selection?.description.replace(`/${selection?.label}`, ``),
          repo: selection?.label,
        });
        mrDataProvider.refresh();
        releaseDataProvider.refresh();
      } catch (e) {
        vscode.window.showWarningMessage(`Repo list: fetch failed.`);
      }
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      `codingPlugin.showDiff`,
      async (file: IFileNode, mr: IMRData) => {
        const headUri = vscode.Uri.parse(file.path, false).with({
          scheme: MRUriScheme,
          query: `commit=${file.newSha}&path=${file.path}`,
        });
        const parentUri = headUri.with({ query: `commit=${file.oldSha}&path=${file.path}` });
        await vscode.commands.executeCommand(
          `vscode.diff`,
          parentUri,
          headUri,
          `${file.name} (Merge Request #${mr.iid})`,
          { preserveFocus: true },
        );

        const commentResp = await codingSrv.getMRComments(mr.iid);
        const comments = (commentResp.data as IDiffComment[][])
          .filter((i) => {
            const first = i[0];
            return !first.outdated && first.path === file.path;
          }, [])
          .map((i) => {
            const root = i[0];
            const isRight = root.change_type === 1;
            const isLeft = root.change_type === 2;
            const both = root.change_type === 3;

            const rootLine = root.diffFile.diffLines[root.diffFile.diffLines.length - 1];
            const lineNum = isLeft ? rootLine.leftNo : rootLine.rightNo;
            const range = new vscode.Range(lineNum, 0, lineNum, 0);
            const commentList: vscode.Comment[] = i.map((c) => {
              const body = new vscode.MarkdownString(`${c.content}`);
              body.isTrusted = true;
              const comment: vscode.Comment = {
                mode: vscode.CommentMode.Preview,
                body: c.content,
                author: {
                  name: `${c.author.name}(${c.author.global_key})`,
                  iconPath: vscode.Uri.parse(c.author.avatar, false),
                },
              };
              return comment;
            });
            commentController.createCommentThread(headUri, range, commentList);
          });
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `codingPlugin.diff.createComment`,
      async (reply: vscode.CommentReply) => {
        replyNote(reply);
      },
    ),
  );

  if (vscode.window.registerWebviewPanelSerializer) {
    // Make sure we register a serializer in activation event
    vscode.window.registerWebviewPanelSerializer(Panel.viewType, {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
        Panel.revive(webviewPanel, codingSrv, context.extensionUri, context.extensionPath);
      },
    });
  }
}

export function deactivate() {}
