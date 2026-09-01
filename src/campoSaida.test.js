import fs from "fs";
import path from "path";

describe("contrato do campo de saída (fechar só ao terminar a edição)", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");

  test("existe um campo de saída que grava apenas no fim da edição", () => {
    expect(fonte).toContain("function CampoSaida");
    expect(fonte).toContain("onBlur={() => { if (rascunho !== (valor ?? \"\")) onCommit(rascunho); }}");
    expect(fonte).toContain('if (event.key === "Enter") event.currentTarget.blur();');
  });

  test("a tabela de posições abertas usa o campo com commit no blur", () => {
    expect(fonte).toContain("<CampoSaida valor={position.saida}");
  });

  test("a saída das posições abertas não grava mais a cada tecla", () => {
    // O padrão antigo salvava no primeiro dígito, fechava a posição e a
    // linha sumia da tabela de abertas com o número pela metade.
    expect(fonte).not.toContain(
      'onChange={(event) => updatePosition(position.id, "saida", event.target.value)} style={cellInputStyle} type="number" step="0.01" placeholder={fmtPrice(position.exit)}',
    );
  });

  test("digitar a saída completa continua fechando a posição ao concluir", () => {
    expect(fonte).toContain(
      'if (field === "saida" && value !== "" && updated.lado !== "Termo") updated.status = "Fechada";',
    );
  });
});
