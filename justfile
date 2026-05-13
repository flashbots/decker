install:
    deno install -gAf -n decker cli.ts

artifacts recipe="l1":
    @rm -rf artifacts
    @builder-playground start {{recipe}} --dry-run --output artifacts
