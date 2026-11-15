import { createSocialMetricsHandler } from "../server/social-metrics.js";
export default {
  fetch(request: Request) {
    return createSocialMetricsHandler(process.env)(request);
  },
};
