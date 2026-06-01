export function Footer() {
  return (
    <footer className="bg-gray-900 text-white py-14 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center">
                <span className="text-white text-xs font-bold">IF</span>
              </div>
              <span className="font-bold text-white">InspectFlow</span>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              DevTools → Source code sync powered by Gemini AI.
            </p>
          </div>

          {[
            { heading: "Product", links: ["Features", "How it works", "Changelog", "Roadmap"] },
            { heading: "Developers", links: ["Documentation", "GitHub", "MCP Protocol", "Extension API"] },
            { heading: "Company", links: ["About", "Blog", "Privacy", "Terms"] },
          ].map(({ heading, links }) => (
            <div key={heading}>
              <h4 className="text-sm font-semibold text-gray-300 mb-3">{heading}</h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link}>
                    <a href="#" className="text-gray-400 text-sm hover:text-white transition-colors">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-800 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-500 text-sm">© 2026 InspectFlow Demo.</p>
          <p className="text-gray-600 text-xs">
            No extra code in this app — source files are discovered automatically by className.
          </p>
        </div>
      </div>
    </footer>
  );
}
