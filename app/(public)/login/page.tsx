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
          <h1 className="text-xl font-semibold">Log in</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back — let&apos;s see what&apos;s due.
          </p>
        </div>
        <LoginForm next={params.next} />
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <Link href="/reset-password" className="hover:text-foreground">
            Forgot your password?
          </Link>
          <span>
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-primary hover:underline">
              Create one
            </Link>
          </span>
        </div>
      </Card>
    </main>
  );
}
