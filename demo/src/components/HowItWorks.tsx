const STEPS = [
  {
    num: "01",
    title: "Start the MCP server",
    description: (
      <>
        Run{" "}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
          PROJECT_ROOT=./demo npm run dev
        </code>{" "}
        in the <strong>server/</strong> directory. The server listens on port 4399.
      </>
    ),
  },
  {
    num: "02",
    title: "Load the Chrome extension",
    description: (
      <>
        Open{" "}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
          chrome://extensions
        </code>
        , enable Developer mode, and load <strong>extension/dist</strong> as an
        unpacked extension. Click the icon to confirm the server is reachable.
      </>
    ),
  },
  {
    num: "03",
    title: "Start capture in DevTools",
    description:
      "Open DevTools on this page, switch to the InspectFlow panel, and click Start Capture. The button turns red — you are live.",
  },
  {
    num: "04",
    title: "Click an element and edit a style",
    description:
      "In the Elements panel, click any card or heading. Then edit a CSS property in the Styles sub-panel — e.g. change padding from 16px to 32px.",
  },
  {
    num: "05",
    title: "Analyze → review the diff",
    description:
      "Back in the InspectFlow panel you will see the captured change. Click Analyze → — the server greps your project for the matching file, then asks Gemini which class to swap. A contextual diff appears.",
  },
  {
    num: "06",
    title: "Apply and watch hot reload",
    description:
      "Click Apply. The source file is updated via Babel AST. Next.js hot reload reflects the change immediately — and it persists on refresh.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 px-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">
          How it works
        </h2>
        <p className="text-gray-500 text-center mb-14 max-w-xl mx-auto">
          Six steps from install to your first persistent style change — no code
          changes to your app required.
        </p>

        <div className="space-y-10">
          {STEPS.map((step) => (
            <div key={step.num} className="flex gap-6">
              <div className="flex-none w-12 h-12 bg-indigo-600 text-white rounded-xl flex items-center justify-center font-bold text-sm">
                {step.num}
              </div>
              <div className="pt-1">
                <h3 className="font-semibold text-gray-900 mb-1">{step.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
