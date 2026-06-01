import { ClientOnly } from 'vite-react-ssg';
import { companies } from '@/content/companies';
import { Experience } from '@/ui/Experience';
import { ResumeContent } from '@/ui/ResumeContent';

export default function Landing() {
  return (
    <>
      <ResumeContent companies={companies} />
      <ClientOnly>{() => <Experience companies={companies} />}</ClientOnly>
    </>
  );
}
