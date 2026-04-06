import "reflect-metadata";
import express from "express";
import { postgraphile, PostGraphileOptions } from "postgraphile";
import dotenv from "dotenv";
import ConnectionFilterPlugin from "postgraphile-plugin-connection-filter";
import { createServer } from "node:http";
import cors from "cors";
import { config } from "./config";

dotenv.config();

const isDev = process.env.NODE_ENV === "development";

async function main() {
  const database = config.databaseUrl || {
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPass,
    database: config.dbName,
  };

  const options: PostGraphileOptions = {
    watchPg: isDev,
    graphiql: true,
    enhanceGraphiql: isDev,
    subscriptions: true,
    dynamicJson: true,
    setofFunctionsContainNulls: false,
    disableDefaultMutations: true,
    ignoreRBAC: false,
    showErrorStack: isDev ? "json" : true,
    extendedErrors: ["hint", "detail", "errcode"],
    allowExplain: isDev,
    legacyRelations: "omit",
    exportGqlSchemaPath: `${__dirname}/schema.graphql`,
    sortExport: true,
    appendPlugins: [ConnectionFilterPlugin],
    graphqlRoute: "/graphql",
    graphiqlRoute: "/graphiql",
  };

  const middleware = postgraphile(database, "public", options);
  const app = express();
  const allowedOrigins = new Set([
    ...config.frontendOrigins,
    `http://localhost:${config.gqlPort}`,
    `http://127.0.0.1:${config.gqlPort}`,
    `http://0.0.0.0:${config.gqlPort}`,
  ]);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`CORS blocked for origin: ${origin}`));
      },
    })
  );
  app.use(middleware);

  const server = createServer(app);
  server.listen({ host: "0.0.0.0", port: config.gqlPort }, () => {
    const address = server.address();
    if (address && typeof address !== "string") {
      console.log(
        `PostGraphiQL available at http://${address.address}:${address.port}${
          options.graphiqlRoute || "/graphiql"
        }`
      );
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
