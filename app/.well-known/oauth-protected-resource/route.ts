import {
  protectedResourceHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from "@clerk/mcp-tools/next";
import { APP_URL } from "@/lib/constants";

const handler = protectedResourceHandlerClerk({
  scopes_supported: ["profile", "email"],
  logo_uri: `${APP_URL}/icon.png`,
});
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
