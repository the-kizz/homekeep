import { ResetConfirmForm } from '@/components/forms/reset-confirm-form';
import { Card } from '@/components/ui/card';

export default async function ResetConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Set a new password</h1>
          <p className="text-sm text-muted-foreground">
            Choose a password of at least 8 characters.
          </p>
        </div>
        <ResetConfirmForm token={token} />
      </Card>
    </main>
  );
}
