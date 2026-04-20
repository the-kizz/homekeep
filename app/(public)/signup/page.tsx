import Link from 'next/link';
import { SignupForm } from '@/components/forms/signup-form';
import { Card } from '@/components/ui/card';

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Create your account</h1>
          <p className="text-sm text-muted-foreground">
            One account, one household — more members can join later.
          </p>
        </div>
        <SignupForm />
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Log in
          </Link>
        </p>
      </Card>
    </main>
  );
}
