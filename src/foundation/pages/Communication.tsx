import { MemberCenter } from "../features/center/MemberCenter";
export function NotificationsPage() {
  return <MemberCenter mode="notifications" />;
}
export function ReportPage() {
  return <MemberCenter mode="reports" />;
}
export function SupportPage() {
  return <MemberCenter mode="support" />;
}
