import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import AuroraBackdrop from "@/components/reactbits/AuroraBackdrop"
import ShinyText from "@/components/reactbits/ShinyText"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import { getCurrentUser, resetPasswordForEmail, signIn, signUp } from "@/lib/auth"

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const reduce = useReducedMotion()
  // Post-auth destination (e.g. back to a /shared/<token> page). Only allow
  // in-app paths to avoid open redirects. Default to tables on the revamp routes.
  const rawNext = new URLSearchParams(location.search).get("next")
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/tables"
  const [mode, setMode] = useState("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const user = await getCurrentUser()
        if (!cancelled && user) {
          navigate(next, { replace: true })
        }
      } catch {
        // No session — show the form.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [navigate, next])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError("")
    setNotice("")

    if (mode === "forgot") {
      setSubmitting(true)
      try {
        await resetPasswordForEmail(email.trim())
        setNotice("Check your email for a link to reset your password.")
      } catch (err) {
        setError(err?.message || "Something went wrong. Please try again.")
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setSubmitting(true)
    try {
      if (mode === "login") {
        await signIn(email.trim(), password)
        navigate(next, { replace: true })
        return
      }

      const { needsConfirmation } = await signUp(email.trim(), password)
      if (needsConfirmation) {
        // Email confirmation is required — the account exists but has no session
        // yet. Send them to the sign-in tab with a heads-up.
        setMode("login")
        setPassword("")
        setConfirmPassword("")
        setNotice("Almost there — check your email for a confirmation link, then sign in.")
        return
      }
      // Confirmation disabled: the session is live immediately.
      navigate(next, { replace: true })
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const toggleMode = () => {
    setMode((current) => (current === "login" ? "signup" : "login"))
    setError("")
    setNotice("")
    setConfirmPassword("")
  }

  const showForgotPassword = () => {
    setMode("forgot")
    setError("")
    setNotice("")
    setPassword("")
    setConfirmPassword("")
  }

  const backToLogin = () => {
    setMode("login")
    setError("")
    setNotice("")
  }

  const isLogin = mode === "login"
  const isForgot = mode === "forgot"
  const eyebrow = isForgot ? "Reset password" : isLogin ? "Welcome back" : "Join the table"
  const description = isForgot
    ? "Enter your email and we'll send you a link to reset your password."
    : isLogin
    ? "Sign in to access your tables and preferences."
    : "Create an account to start tracking sessions."

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
                text={eyebrow}
                speed={3.5}
                className="text-xs font-medium uppercase tracking-[0.16em]"
                color="#8fa3c8"
                shineColor="#eef3ff"
              />
            </span>
          </div>

          <p className="text-sm text-muted-foreground">{description}</p>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: reduce ? 0 : 0.12, ease: [0.16, 1, 0.3, 1] }}
        >
          <SpotlightCard className="bg-card/70 p-5 backdrop-blur-md sm:p-6">
            {loading ? (
              <div className="space-y-3 py-4 animate-pulse" aria-busy="true" aria-label="Loading">
                <div className="h-3 w-1/3 rounded-full bg-muted" />
                <div className="h-11 rounded-xl bg-muted/70" />
                <div className="h-11 rounded-xl bg-muted/50" />
              </div>
            ) : (
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="bg-background/50"
                  />
                </div>
                {!isForgot && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      {isLogin && (
                        <button
                          type="button"
                          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                          onClick={showForgotPassword}
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete={isLogin ? "current-password" : "new-password"}
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
                )}
                {!isLogin && !isForgot && (
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm password</Label>
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
                )}
                {notice && <p className="text-sm text-primary">{notice}</p>}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="w-full rounded-xl" size="lg" type="submit" disabled={submitting}>
                  {submitting
                    ? "Please wait…"
                    : isForgot
                    ? "Send reset link"
                    : isLogin
                    ? "Sign in"
                    : "Create account"}
                </Button>
                {isForgot ? (
                  <p className="text-center text-sm text-muted-foreground">
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      onClick={backToLogin}
                    >
                      Back to sign in
                    </button>
                  </p>
                ) : (
                  <p className="text-center text-sm text-muted-foreground">
                    {isLogin ? "No account yet?" : "Already have an account?"}{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      onClick={toggleMode}
                    >
                      {isLogin ? "Sign up" : "Sign in"}
                    </button>
                  </p>
                )}
                <p className="text-center text-sm text-muted-foreground">
                  <Link to="/" className="text-primary underline-offset-4 hover:underline">
                    Back to home
                  </Link>
                </p>
              </form>
            )}
          </SpotlightCard>
        </motion.div>
      </div>
    </div>
  )
}
