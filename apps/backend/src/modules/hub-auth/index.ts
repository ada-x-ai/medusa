import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import HubAuthService from "./service"

export default ModuleProvider(Modules.AUTH, { services: [HubAuthService] })
