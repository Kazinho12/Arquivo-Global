import { createNotificationJobsHandler } from "../server/notification-jobs.js";
export default {
  fetch(request: Request) {
    return createNotificationJobsHandler(process.env)(request);
  },
};
