import "server-only";

import { cache } from "react";

import { createRequestContext } from "./context";
import { appRouter } from "./router";

const getContext = cache(() => createRequestContext());

export const api = appRouter.createCaller(getContext);
