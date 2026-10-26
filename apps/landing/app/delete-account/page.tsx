import { Legal } from '@/components/legal';
import { DeleteAccountForm } from '@/components/forms';
export const metadata = { title: 'Delete Your Account' };
export default function Page() { return <Legal file="delete-account"><DeleteAccountForm /></Legal>; }
