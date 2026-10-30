'use client';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { ProfileForm } from '@/components/profile-form';
import { useMe } from '@/components/use-me';

export default function SetupProfile() {
  const router = useRouter();
  const { me } = useMe();
  return (
    <AuthShell art="selfie">
      <div>
        <h1>Set up your profile</h1>
        <p className="lead">This is how friends will see you in chats.</p>
      </div>
      {me ? <ProfileForm me={me} submitLabel="Continue" onSaved={() => router.replace('/chats')} /> : <div aria-busy="true" style={{ height: 320 }} />}
    </AuthShell>
  );
}
