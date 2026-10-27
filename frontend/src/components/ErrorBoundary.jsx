import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  reload = () => {
    sessionStorage.removeItem("chatHistory"); // a corrupt saved chat is the usual cause
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-[#FAF8F5] p-6 text-center text-[#1C1917] dark:bg-[#141312] dark:text-[#F5F2EB]">
        <h1 className="font-serif-editorial text-2xl">Something went wrong</h1>
        <p className="max-w-sm text-sm text-[#57534E] dark:text-[#A8A29E]">
          The page hit an unexpected error. Reloading clears your saved chats; your library stays on the server.
        </p>
        <button
          type="button"
          onClick={this.reload}
          className="cursor-pointer rounded-xl bg-[#C85A32] px-4 py-2 text-sm font-medium text-white hover:bg-[#B24C28]"
        >
          Reload
        </button>
      </div>
    );
  }
}
