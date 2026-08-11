// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("kapow");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("shows the error message when a child throws", () => {
    // Spy on console.error to keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("kapow")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("localizes the fallback UI in the stored language (es)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("meditor.language.v1", "es");
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Algo salió mal")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("localizes the fallback UI in an RTL language (ar)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("meditor.language.v1", "ar");
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ ما")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeTruthy();
  });

  it("falls back to English for an unknown stored language", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("meditor.language.v1", "zz");
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("recovers when Try again is clicked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const button = screen.getByRole("button", { name: "Try again" });
    // Re-render with safe children while the error state is still active.
    // The fallback UI is still shown because the boundary hasn't reset yet.
    rerender(
      <ErrorBoundary>
        <div>recovered</div>
      </ErrorBoundary>,
    );
    // Click "Try again" to clear the error state. Since the children are now
    // safe, the component renders them instead of the fallback UI.
    button.click();
    await screen.findByText("recovered");
  });
});
