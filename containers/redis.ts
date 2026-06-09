import type { ContainerDef, ContainerResult } from "../utils/types.ts";

export const ports = {
  redis: 6379,
};

export function buildContainer(_def: ContainerDef): ContainerResult {
  return {
    container: {
      image: "docker.io/redis:7-alpine",
      ports,
    },
  };
}
