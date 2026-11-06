import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/s/budget?cell=B7');
}
