import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="flex justify-center px-4 py-16">
      <SignUp />
    </main>
  );
}
