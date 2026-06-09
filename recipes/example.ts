import type { Prototype, Recipe } from "../utils/types.ts";

const hello: Prototype = {
  ports: {},
  buildContainer: () => ({
    container: {
      image: "busybox:1.36",
      command: ["sh", "-c"],
      args: ["echo 'hello, world' && sleep 3600"],
    },
  }),
};

export const recipe: Recipe = {
  artifacts: { generator: "l1", fork: "electra" },
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
