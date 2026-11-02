import Header from "./components/Header.jsx";
import { useHashRoute } from "./hooks/useHashRoute.js";
import BookPage from "./pages/BookPage.jsx";
import InventoryPage from "./pages/InventoryPage.jsx";

export default function App() {
  const { path, params } = useHashRoute();

  return (
    <>
      <Header path={path} />
      {/* One fluid container for both pages: it grows with the screen up to 80rem. */}
      <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pb-24 lg:pt-10">
        {path === "/book" ? (
          <BookPage presetItemId={Number(params.get("item")) || null} />
        ) : (
          <InventoryPage />
        )}
      </main>
    </>
  );
}
