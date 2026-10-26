import { useParams } from 'react-router-dom';

export default function Reader() {
  const { id } = useParams();
  return (
    <main>
      <h1>Reader</h1>
      <p>Reading book {id}. (Step 1 shell — reader arrives in Step 4.)</p>
    </main>
  );
}
