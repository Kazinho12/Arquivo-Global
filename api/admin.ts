import { createAdminHandler } from "../server/admin.js";
export default {
  fetch(request: Request) {
    return createAdminHandler(process.env)(request);
  },
};
