export function Hero() {
  return (
    <section className="bg-gradient-to-b from-indigo-50 to-white pt-32 pb-20 px-6 text-center">
      <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full mb-6">
        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
        DevTools → Source Code Sync
      </div>
      <h1 className="text-5xl font-bold text-gray-900 max-w-3xl mx-auto leading-tight">
        Edit styles visually,{" "}
        <span className="text-indigo-600">persist them instantly</span>
      </h1>
      <p className="mt-6 text-xl text-gray-500 max-w-2xl mx-auto leading-relaxed">
        InspectFlow bridges Chrome DevTools and your React source code. Tweak
        padding, colors, and typography — AI maps your changes back to the right
        Tailwind classes automatically.
      </p>
      <div className="mt-10 flex items-center justify-center gap-4 flex-wrap">
        <a
          href="#how-it-works"
          className="bg-indigo-600 text-white font-semibold px-6 py-3 rounded-xl text-sm hover:bg-indigo-700 transition-colors shadow-sm"
        >
          See how it works →
        </a>
        <a
          href="#features"
          className="bg-white text-gray-700 font-semibold px-6 py-3 rounded-xl text-sm border border-gray-200 hover:border-indigo-300 transition-colors"
        >
          View features
        </a>
      </div>
      <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto">
        {[
          { label: "CSS Properties", value: "∞" },
          { label: "Setup time", value: "2 min" },
          { label: "AI model", value: "Gemini" },
        ].map(({ label, value }) => (
          <div key={label}>
            <div className="text-3xl font-bold text-indigo-600">{value}</div>
            <div className="text-sm text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
