import Link from 'next/link';
import { ResetRequestForm } from '@/components/forms/reset-request-form';
import { Card } from '@/components/ui/card';

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>
        <ResetRequestForm />
        <p className="text-sm text-muted-foreground">
          Remembered it?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Back to login
          </Link>
        </p>
      </Card>
    </main>
  );
}
