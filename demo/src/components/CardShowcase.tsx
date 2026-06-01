function ProfileCard() {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex flex-col items-center text-center">
      <div className="w-16 h-16 bg-gradient-to-br from-indigo-400 to-purple-500 rounded-full flex items-center justify-center text-white text-2xl font-bold mb-4">
        A
      </div>
      <h3 className="text-base font-semibold text-gray-900">Aryan Bansal</h3>
      <p className="text-sm text-gray-500 mt-1">Frontend Engineer</p>
      <div className="mt-4 flex gap-2">
        <span className="bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-1 rounded-full">
          React
        </span>
        <span className="bg-purple-50 text-purple-700 text-xs font-medium px-2 py-1 rounded-full">
          TypeScript
        </span>
      </div>
      <button className="mt-5 w-full bg-indigo-600 text-white text-sm font-medium py-2 rounded-xl hover:bg-indigo-700 transition-colors">
        Follow
      </button>
    </div>
  );
}

function StatCard({ label, value, change }: { label: string; value: string; change: string }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
      <span className="inline-block mt-2 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
        {change}
      </span>
    </div>
  );
}

function PricingCard({
  plan,
  price,
  features,
  highlighted,
}: {
  plan: string;
  price: string;
  features: string[];
  highlighted: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-8 border flex flex-col ${
        highlighted
          ? "bg-indigo-600 border-indigo-500 text-white"
          : "bg-white border-gray-100 shadow-sm"
      }`}
    >
      <p className={`text-sm font-semibold ${highlighted ? "text-indigo-200" : "text-gray-500"}`}>
        {plan}
      </p>
      <p className={`text-4xl font-bold mt-2 ${highlighted ? "text-white" : "text-gray-900"}`}>
        {price}
      </p>
      <ul className="mt-6 space-y-3 flex-1">
        {features.map((f) => (
          <li
            key={f}
            className={`flex items-center gap-2 text-sm ${highlighted ? "text-indigo-100" : "text-gray-600"}`}
          >
            <span className={highlighted ? "text-indigo-300" : "text-indigo-500"}>✓</span>
            {f}
          </li>
        ))}
      </ul>
      <button
        className={`mt-8 w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
          highlighted
            ? "bg-white text-[#0ac5b2] hover:bg-indigo-50"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        Get started
      </button>
    </div>
  );
}

export function CardShowcase() {
  return (
    <section id="showcase" className="py-20 px-6 bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">
          Component showcase
        </h2>
        <p className="text-gray-500 text-center mb-12 max-w-xl mx-auto">
          These cards are your playground. Click any element in DevTools, tweak a
          style, and let InspectFlow sync it back — no extra code in this app.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="md:col-span-1">
            <ProfileCard />
          </div>
          <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <StatCard label="Total changes" value="1,284" change="↑ 12% this week" />
            <StatCard label="Files updated" value="47" change="↑ 3 today" />
            <StatCard label="Time saved" value="6.2h" change="vs. manual edits" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PricingCard
            plan="Hobby"
            price="Free"
            features={["Local MCP server", "Chrome extension", "Community support"]}
            highlighted={false}
          />
          <PricingCard
            plan="Pro"
            price="$12/mo"
            features={["Everything in Hobby", "Team sharing", "Priority support", "Custom models"]}
            highlighted={true}
          />
          <PricingCard
            plan="Enterprise"
            price="Custom"
            features={["SSO & audit logs", "On-prem deployment", "SLA guarantee", "Dedicated support"]}
            highlighted={false}
          />
        </div>
      </div>
    </section>
  );
}
