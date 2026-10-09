import Link from 'next/link';
import { LoginForm } from '@/components/forms/login-form';
import { Card } from '@/components/ui/card';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-medium tracking-tight">Log in</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back. Let&apos;s see what&apos;s due.
          </p>
        </div>
        <LoginForm next={params.next} />
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <Link
            href="/reset-password"
            className="self-start text-link underline underline-offset-2 hover:text-link/80 bold-link"
          >
            Forgot your password?
          </Link>
          <span>
            Don&apos;t have an account?{' '}
            {/* Mirror the Phase 9 signup-page fix: persistent underline
                so the link is identifiable beyond color alone. */}
            <Link
              href="/signup"
              className="text-link underline underline-offset-2 hover:text-link/80 bold-link"
            >
              Create one
            </Link>
          </span>
        </div>
      </Card>
    </main>
  );
}
