import { Column, Heading } from '@hanzo/react-zen';

export function Board({ boardId }: { boardId: string }) {
  return (
    <Column>
      <Heading>Board title</Heading>
      <div>{boardId}</div>
    </Column>
  );
}
