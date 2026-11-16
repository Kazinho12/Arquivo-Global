import { NotificationInbox } from "../features/notifications/Notifications";
import { notificationsAnalyticsEnabled } from "../features/notifications/repository";
import { MemberCenter } from "../features/center/MemberCenter";
export function NotificationsPage() {
  return notificationsAnalyticsEnabled ? (
    <NotificationInbox />
  ) : (
    <MemberCenter mode="notifications" />
  );
}
export function ReportPage() {
  return <MemberCenter mode="reports" />;
}
export function SupportPage() {
  return <MemberCenter mode="support" />;
}
