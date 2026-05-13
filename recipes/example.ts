import type { Prototype, Recipe } from "../utils/types.ts";

const hello: Prototype = {
  ports: {},
  build: () => ({
    container: {
      image: "busybox:1.36",
      command: ["sh", "-c"],
      args: ["echo 'hello, world' && sleep 3600"],
    },
  }),
};

export const recipe: Recipe = {
  artifacts: "l1",
  pods: [
    {
      name: "hello",
      containers: [
        { name: "hello", prototype: hello },
      ],
    },
    {
      name: "el-1",
      containers: [
        { name: "el-1", prototype: "reth" },
      ],
    },
  ],
};
