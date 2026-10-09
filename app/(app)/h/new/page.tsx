import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { HomeForm } from '@/components/forms/home-form';

/**
 * /h/new — create-a-home form (02-04, HOME-01).
 *
 * Protected by the (app) layout which handles the auth redirect. The form
 * server action revalidates /h and redirects to the new home on success.
 */
export default function NewHomePage() {
  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a home</CardTitle>
          <CardDescription>
            Give your home a name. You can add the address and change the
            timezone anytime.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <HomeForm mode="create" />
          <p className="text-sm text-muted-foreground">
            <Link href="/h" className="underline">
              Back to homes
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
