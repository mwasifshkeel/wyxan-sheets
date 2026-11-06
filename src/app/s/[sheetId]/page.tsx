import { Spreadsheet } from '@/components/Spreadsheet';

type Props = { params: Promise<{ sheetId: string }> };
export default async function SheetPage({ params }: Props) {
  return <Spreadsheet initialSheetId={(await params).sheetId} />;
}
