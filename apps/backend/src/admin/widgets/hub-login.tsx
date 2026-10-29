import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect, useState } from "react"

const HubLogin = () => {
  const [message, setMessage] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    fetch("/identity/config", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Identity configuration is unavailable")
        const result: unknown = await response.json()
        if (typeof result !== "object" || result === null || !("enabled" in result) ||
          typeof result.enabled !== "boolean") throw new Error("Invalid identity configuration")
        if (result.enabled) {
          setMessage("Connecting to Hub...")
          window.location.replace("/identity/start")
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Unable to connect to Hub. Refresh to try again.")
      })
    return () => controller.abort()
  }, [])
  return message ? <p role="status">{message}</p> : null
}

export const config = defineWidgetConfig({ zone: "login.before" })
export default HubLogin
