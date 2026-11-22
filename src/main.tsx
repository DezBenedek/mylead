import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles/app.css";
import { myleadTheme } from "./theme";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={myleadTheme} defaultColorScheme="light">
      <Notifications position="bottom-right" limit={4} />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
