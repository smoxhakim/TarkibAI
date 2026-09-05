import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="flex justify-center px-4 py-16">
      <SignIn />
    </main>
  );
}
