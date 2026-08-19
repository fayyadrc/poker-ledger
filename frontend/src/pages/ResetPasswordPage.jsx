import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import AuroraBackdrop from "@/components/reactbits/AuroraBackdrop"
import ShinyText from "@/components/reactbits/ShinyText"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import { getCurrentUser, onAuthChange, updatePassword } from "@/lib/auth"

// Landing page for the Supabase password-reset email link. Supabase's
// detectSessionInUrl exchanges the link's token for a recovery session before
// this mounts, so we just wait for a user to show up and let them set a new
// password. No recovery session (expired/reused link) means no user.
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const user = await getCurrentUser()
      if (!cancelled) {
        setHasSession(Boolean(user))
        setChecking(false)
      }
    }
    bootstrap()

    const unsubscribe = onAuthChange((user) => {
      if (!cancelled) setHasSession(Boolean(user))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setSubmitting(true)
    try {
      await updatePassword(password)
      setDone(true)
      setTimeout(() => navigate("/tables", { replace: true }), 1500)
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-background text-foreground">
      <AuroraBackdrop reduce={reduce} />

      <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 overflow-y-auto px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <motion.div
          className="space-y-3 text-center"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <Link
            to="/"
            className="inline-block text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          >
            <span className="text-primary">♠</span> Poker Ledger
          </Link>

          <div className="flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3.5 py-1.5 backdrop-blur-sm">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              <ShinyText
                disabled={reduce}
                text="Reset password"
                speed={3.5}
                className="text-xs font-medium uppercase tracking-[0.16em]"
                color="#8fa3c8"
                shineColor="#eef3ff"
              />
            </span>
          </div>

          <p className="text-sm text-muted-foreground">Choose a new password for your account.</p>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: reduce ? 0 : 0.12, ease: [0.16, 1, 0.3, 1] }}
        >
          <SpotlightCard className="bg-card/70 p-5 backdrop-blur-md sm:p-6">
            {checking ? (
              <div className="space-y-3 py-4 animate-pulse" aria-busy="true" aria-label="Loading">
                <div className="h-3 w-1/3 rounded-full bg-muted" />
                <div className="h-11 rounded-xl bg-muted/70" />
                <div className="h-11 rounded-xl bg-muted/50" />
              </div>
            ) : done ? (
              <p className="py-2 text-center text-sm text-primary">
                Password updated. Taking you to your tables…
              </p>
            ) : !hasSession ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  This reset link is invalid or has expired. Request a new one from the sign-in page.
                </p>
                <Button
                  className="w-full rounded-xl"
                  size="lg"
                  onClick={() => navigate("/login")}
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="bg-background/50 pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="bg-background/50"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="w-full rounded-xl" size="lg" type="submit" disabled={submitting}>
                  {submitting ? "Please wait…" : "Update password"}
                </Button>
              </form>
            )}
          </SpotlightCard>
        </motion.div>
      </div>
    </div>
  )
}
