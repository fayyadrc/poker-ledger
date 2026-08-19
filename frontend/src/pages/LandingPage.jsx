import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowRight, Calculator, Layers, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import AuroraBackdrop from "@/components/reactbits/AuroraBackdrop"
import BlurText from "@/components/reactbits/BlurText"
import ShinyText from "@/components/reactbits/ShinyText"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import { getCurrentUser } from "@/lib/auth"

const HEADLINE = "Settle the table without the spreadsheet"

function useFadeUp(reduce) {
  return reduce
    ? {}
    : {
        initial: { opacity: 0, y: 20 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.25 },
        transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
      }
}

function LandingNav({ authed }) {
  return (
    <header className="relative z-10 shrink-0 pt-safe">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 md:h-[4.5rem] md:px-8">
        <Link to="/" className="text-base font-semibold tracking-tight text-foreground">
          <span className="text-primary">♠</span> Poker Ledger
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          {authed ? (
            <Link to="/tables">
              <Button size="sm" className="rounded-xl">
                Open ledger
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/login">
                <Button variant="ghost" size="sm" className="rounded-xl">
                  Sign in
                </Button>
              </Link>
              <Link to="/login">
                <Button size="sm" className="rounded-xl">
                  Sign up
                </Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

function OverviewSection({ authed, reduce, motionProps }) {
  const appLink = authed ? "/tables" : "/login"

  const features = [
    {
      icon: Layers,
      title: "Tables for your crew",
      body: "Create a table, pick a currency, and add your regulars once.",
    },
    {
      icon: Calculator,
      title: "Chip math, sorted",
      body: "Count stacks fast with your own chip denominations, right at the table.",
    },
    {
      icon: Scale,
      title: "Settle up in seconds",
      body: "See who's up, who's down, and the minimum transfers to close the night.",
    },
  ]

  const headlineClasses =
    "max-w-2xl text-3xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-4xl md:text-5xl"

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col justify-center gap-8 px-5 py-8 md:gap-12 md:px-8">
      <div className="max-w-2xl space-y-4 md:space-y-5">
        <motion.div {...motionProps} className="flex">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3.5 py-1.5 backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            <ShinyText
              disabled={reduce}
              text="Built for home games"
              speed={3.5}
              className="text-xs font-medium uppercase tracking-[0.16em]"
              color="#8fa3c8"
              shineColor="#eef3ff"
            />
          </span>
        </motion.div>

        {reduce ? (
          <h1 className={headlineClasses}>{HEADLINE}</h1>
        ) : (
          <>
            <h1 className="sr-only">{HEADLINE}</h1>
            <BlurText aria-hidden="true" text={HEADLINE} delay={70} stepDuration={0.3} className={headlineClasses} />
          </>
        )}

        <motion.p
          {...motionProps}
          transition={{ ...motionProps.transition, delay: 0.25 }}
          className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base"
        >
          Poker Ledger tracks buy-ins, cash-outs, and chip counts for your home game, then tells you exactly who owes
          who when the night ends.
        </motion.p>

        <motion.div
          {...motionProps}
          transition={{ ...motionProps.transition, delay: 0.35 }}
          className="flex flex-wrap items-center gap-3 pt-2"
        >
          <Link to={appLink}>
            <Button size="lg" className="rounded-xl px-6">
              {authed ? "Open ledger" : "Sign up free"}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </Link>
          {!authed && (
            <Link to="/login">
              <Button variant="outline" size="lg" className="rounded-xl px-6 bg-card/40 backdrop-blur-sm">
                Sign in
              </Button>
            </Link>
          )}
        </motion.div>
      </div>

      <motion.div
        {...motionProps}
        transition={{ ...motionProps.transition, delay: 0.45 }}
        className="grid gap-3 sm:grid-cols-3 sm:gap-4"
      >
        {features.map((feature) => (
          <SpotlightCard
            key={feature.title}
            className="flex items-start gap-3 bg-card/60 p-4 backdrop-blur-md sm:flex-col sm:gap-2.5 sm:p-5"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <feature.icon className="size-4.5" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm leading-snug text-muted-foreground">{feature.body}</p>
            </div>
          </SpotlightCard>
        ))}
      </motion.div>
    </section>
  )
}

export default function LandingPage() {
  const reduce = useReducedMotion()
  const motionProps = useFadeUp(reduce)
  const [authed, setAuthed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    getCurrentUser()
      .then((user) => {
        if (!cancelled) setAuthed(!!user)
      })
      .catch(() => {
        if (!cancelled) setAuthed(false)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const isAuthed = ready && authed

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <AuroraBackdrop reduce={reduce} />
      <LandingNav authed={isAuthed} />
      <main className="relative z-10 flex min-h-0 flex-1 flex-col">
        <OverviewSection authed={isAuthed} reduce={reduce} motionProps={motionProps} />
      </main>
    </div>
  )
}
