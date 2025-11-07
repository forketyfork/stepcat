{
  description = "Stepcat - Step-by-step agent orchestration solution";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_24
            just
            git
            sqlite
          ];

          shellHook = ''
            echo "Stepcat development environment"
            echo "Node version: $(node --version)"
            echo "npm version: $(npm --version)"
            echo ""
            echo "Available commands:"
            echo "  just build    - Build the project"
            echo "  just test     - Run tests"
            echo "  just lint     - Run linter"
            echo "  just ci       - Run full CI check"
            echo ""
          '';
        };
      }
    );
}
