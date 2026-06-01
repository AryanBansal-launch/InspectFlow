interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
  highlight: string;
}

function FeatureCard({ icon, title, description, highlight }: FeatureCardProps) {
  return (
    <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-2xl mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
      <div className="mt-4 inline-block bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-1 rounded">
        {highlight}
      </div>
    </div>
  );
}

const FEATURES: FeatureCardProps[] = [
  {
    icon: "🎨",
    title: "Visual editing",
    description:
      "Change padding, margin, colors, font sizes — anything you can tweak in the Styles panel is captured automatically.",
    highlight: "All CSS properties",
  },
  {
    icon: "🤖",
    title: "AI-powered mapping",
    description:
      "Gemini reads your source file and determines the exact Tailwind class or CSS value to swap — no guessing required.",
    highlight: "gemini-2.5-flash",
  },
  {
    icon: "🔒",
    title: "Approval-gated writes",
    description:
      "You see a full contextual diff before anything is written. Apply or reject — the file is never touched without your say.",
    highlight: "Review before apply",
  },
  {
    icon: "⚡",
    title: "Hot reload",
    description:
      "After applying, Next.js picks up the file change immediately. Your browser reflects the permanent edit without a full refresh.",
    highlight: "Next.js Turbopack",
  },
  {
    icon: "🔍",
    title: "Zero-config source mapping",
    description:
      "No annotations needed. The server greps your project for the element's className string and finds the right file automatically.",
    highlight: "Auto-discovery",
  },
  {
    icon: "🛡️",
    title: "Sandboxed writes",
    description:
      "The server only reads and writes within your PROJECT_ROOT. Path traversal attempts are blocked at validation.",
    highlight: "Security first",
  },
];

export function FeatureSection() {
  return (
    <section id="features" className="py-20 px-6 bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">
          Everything you need
        </h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">
          InspectFlow handles the whole pipeline — from DevTools capture to
          Gemini analysis to AST-safe file writes.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}
