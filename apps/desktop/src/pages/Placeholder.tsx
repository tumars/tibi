import { Empty } from '../components/Empty';
import { Top } from '../components/Shell';

export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <>
      <Top crumbs={[{ label: title }]} />
      <div className="scroll"><Empty title={title} text={text} /></div>
    </>
  );
}
