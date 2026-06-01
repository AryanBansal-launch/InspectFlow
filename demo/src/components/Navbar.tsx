export function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
          <span className="text-[#388e4a] text-xs font-bold">IF</span>
        </div>
        <span className="text-lg font-bold text-gray-900">InspectFlow</span>
      </div>
      <div className="hidden md:flex items-center gap-8">
        <a href="#features" className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">Features</a>
        <a href="#how-it-works" className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">How it works</a>
        <a href="#showcase" className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">Components</a>
      </div>
      <a
        href="https://github.com"
        className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
      >
        GitHub
      </a>
    </nav>
  );
}
