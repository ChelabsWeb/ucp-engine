import { describe, expect, it } from "vitest";
// El motor no toca el disco —es puro, y por eso ni siquiera tiene los tipos de Node—, así que
// la versión del paquete entra como importación y no leyendo el archivo.
import pkg from "../package.json" with { type: "json" };
import { VERSION_MOTOR } from "./version";

describe("la versión del motor", () => {
  it("coincide con la del paquete: si divergen, un examen viejo dice una versión que no existió", () => {
    expect(VERSION_MOTOR).toBe(pkg.version);
  });
});
