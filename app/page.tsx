import { redirect } from 'next/navigation';
// Staff-only system: there is no public page. /admin sends visitors without a session to /login.
export default function Home(){redirect('/admin');}
