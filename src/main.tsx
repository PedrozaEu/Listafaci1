import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import App from "./App.tsx";
import "./index.css";
import { registerAppWorker } from "./lib/pwa";

createRoot(document.getElementById("root")!).render(<App />);

void registerAppWorker(() => toast.success("Pronto para abrir sem internet neste aparelho, incluindo o relatório PDF."));
