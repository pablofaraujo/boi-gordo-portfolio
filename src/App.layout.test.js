import fs from "fs";
import path from "path";

describe("layout compacto das posições em aberto", () => {
  const fonte = fs.readFileSync(path.join(__dirname, "App.jsx"), "utf8");

  test("permite quebra de linha somente nos títulos da tabela", () => {
    expect(fonte).toMatch(/\.data-table th \{[\s\S]*?white-space: normal;/);
    expect(fonte).toMatch(/\.data-table td \{ padding: 6px 5px; \}/);
  });

  test("reserva dez colunas compactas e mais espaço para detalhes", () => {
    const tabela = fonte.match(/<table className="data-table">([\s\S]*?)<\/table>/)?.[1] || "";
    expect(tabela.match(/<col style=/g)).toHaveLength(10);
    expect(tabela).toContain('<col style={{ width: 150 }} />');
    expect(tabela).toContain('<col style={{ width: 60 }} />');
  });

  test("empilha os botões pequenos, centralizados e com a mesma largura", () => {
    expect(fonte).toMatch(/\.open-actions \{[^}]*flex-direction: column;[^}]*align-items: center;/);
    expect(fonte).toMatch(/\.open-action-button \{[\s\S]*?width: 50px;/);
    expect(fonte.match(/className="open-action-button"/g)).toHaveLength(2);
  });
});
