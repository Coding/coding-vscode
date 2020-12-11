import React, { useCallback } from 'react';
import styled from 'styled-components';
import { view } from '@risingstack/react-easy-state';

import appStore from 'webviews/store/appStore';
import { Avatar, AuthorLink } from 'webviews/components/User';
import EditIcon from 'webviews/assets/edit.svg';

const Title = styled.div`
  margin-top: 15px;
  font-size: 16px;
  font-weight: 600;
`;
const FlexCenter = styled.div`
  display: flex;
  align-items: center;
`;
const Item = styled(FlexCenter)`
  padding: 5px 0;
  justify-content: space-between;

  a:first-child {
    margin-right: 5px;
  }
`;
const IconButton = styled.button`
  border: unset;
  background: unset;
  width: 20px;
  height: 20px;
  margin-left: 1ex;
  padding: 2px 0;
  vertical-align: middle;

  :hover {
    cursor: pointer;
  }

  :focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  svg path {
    fill: var(--vscode-foreground);
  }
`;

function Reviewers() {
  const { reviewers, currentMR } = appStore;
  const { reviewers: rReviewers = [], volunteer_reviewers: volunteerReviewers = [] } = reviewers;
  const allReviewers = [...rReviewers, ...volunteerReviewers];
  const { updateReviewers } = appStore;

  const onUpdateReviewer = useCallback(() => {
    const list = allReviewers.map((i) => i.reviewer.id);
    updateReviewers(currentMR.iid, list);
  }, [allReviewers]);

  return (
    <div>
      <Title>
        Reviewers
        <IconButton onClick={onUpdateReviewer}>
          <EditIcon />
        </IconButton>
      </Title>
      {allReviewers.map((r) => {
        return (
          <Item key={r.reviewer.global_key}>
            <FlexCenter>
              <Avatar for={r.reviewer} />
              <AuthorLink for={r.reviewer} />
            </FlexCenter>
            {r.value === 100 && `👍`}
          </Item>
        );
      })}
    </div>
  );
}

export default view(Reviewers);
