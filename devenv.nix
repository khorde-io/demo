{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    npm.enable = true;
  };

  languages.typescript.enable = true;

  enterShell = ''
    echo "Khorde demo HMI · node $(node --version) · npm $(npm --version)"
  '';
}
