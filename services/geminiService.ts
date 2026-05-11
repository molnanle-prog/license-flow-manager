import { GoogleGenAI, Type } from "@google/genai";
import { Customer, Product, License } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const generateLicenseEmail = async (
  customer: Customer,
  product: Product,
  license: License,
  downloadLink: string
): Promise<string> => {
  if (!process.env.API_KEY) {
    return "오류: API 키를 찾을 수 없습니다. REACT_APP_GEMINI_API_KEY를 설정해주세요.";
  }

  const expirationText = license.expiresAt 
    ? new Date(license.expiresAt).toLocaleDateString() 
    : "평생 사용";

  const prompt = `
    소프트웨어 구매 고객에게 보낼 라이선스 안내 이메일 본문을 **아주 간결하게** 한국어로 작성해줘.

    **[중요 규칙]**
    - 전체 내용은 5~6 문장으로 요약하고, 불필요한 인사나 미사여구는 최대한 생략해줘.
    - 핵심 정보(제품명, 키)를 명확하게 전달해야 해.
    - 활성화 방법 안내는 아래 [추가 규칙]을 반드시 따라줘.
    - 이메일 본문만 반환하고, 제목이나 다른 설명은 절대 추가하지 마.

    **[포함할 정보]**
    - 고객 이름: ${customer.name}
    - 제품명: ${product.name} (버전: ${product.version})
    - 시리얼 키: ${license.key}
    - 만료일: ${expirationText}
    - 다운로드 링크: ${downloadLink}

    **[추가 규칙]**
    - 만료일 정보 바로 아래에, 다음 문장을 **수정 없이 그대로** 포함해줘: "해당 기기는 이미 인증 처리가 완료되었습니다. 정품인증 받는란에 기본정보와 제공받은 라이선스 그리고 PIN(본인설정)번호 입력하시고 정품 인증 받으시기 바랍니다."
    - 프로그램 다운로드 안내 시, 위에서 제공된 '다운로드 링크'를 사용해줘.

    **[출력 형식 예시]**
    ${customer.name}님, 안녕하세요.
    ${product.name} 제품을 구매해주셔서 감사합니다.

    라이선스 정보는 다음과 같습니다.
    - 제품: ${product.name} (${product.version})
    - 키: ${license.key}
    - 만료: ${expirationText}

    해당 기기는 이미 인증 처리가 완료되었습니다. 정품인증 받는란에 기본정보와 제공받은 라이선스 그리고 PIN(본인설정)번호 입력하시고 정품 인증 받으시기 바랍니다.

    프로그램은 ${downloadLink} 에서 받으실 수 있습니다.

    감사합니다.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text || "이메일 내용을 생성하지 못했습니다.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "이메일 초안 생성 중 오류가 발생했습니다.";
  }
};

export const generateApprovalMessage = async (
    reqName: string,
    productName: string,
    licenseKey: string,
    isPreActivated: boolean,
    downloadLink: string
): Promise<string> => {
    if (!process.env.API_KEY) return `[발급 완료]\n\n제품: ${productName}\n키: ${licenseKey}`;

    const prompt = `
      상황: 관리자가 소프트웨어 라이선스 발급을 승인했습니다. 고객에게 보낼 짧고 명확한 카카오톡/문자 메시지를 작성해주세요.
      
      정보:
      - 고객명: ${reqName}
      - 제품: ${productName}
      - 키: ${licenseKey}
      - 다운로드 링크: ${downloadLink}
      
      출력 형식 예시 (이 구조를 따라주세요):
      [${reqName} 고객님, 안녕하세요.]
      요청하신 ${productName} 소프트웨어의 라이선스 승인이 완료되었습니다.

      ◼ 제품명: ${productName}
      ◼ 라이선스 키: ${licenseKey}
      ◼ 프로그램 다운로드:
      ${downloadLink}

      [아래 조건에 따른 안내 문구]

      조건:
      - 위의 출력 형식 예시를 따르되, 인사말과 제품/키 정보 부분은 자연스럽게 다듬어도 좋습니다.
      - 공손하고 전문적인 톤을 유지하세요.
      - ${isPreActivated
        ? `안내 문구로 다음 문장을 **수정 없이 그대로** 사용하세요: "해당 기기는 이미 인증 처리가 완료되었습니다. 정품인증 받는란에 기본정보와 제공받은 라이선스 그리고 PIN(본인설정)번호 입력하시고 정품 인증 받으시기 바랍니다. 😊"`
        : `안내 문구로 "라이선스 키를 복사하여 프로그램 인증에 사용해 주세요."와 같이 간단한 안내를 포함하세요.`
      }
      - 최종 결과물은 완성된 메시지만 출력하고, 다른 설명은 절대 추가하지 마세요.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });
        return response.text || `[라이선스 발급]\n${productName}\nKEY: ${licenseKey}`;
    } catch (e) {
        return `[라이선스 발급]\n${productName}\nKEY: ${licenseKey}`;
    }
};

export const analyzeSales = async (
  products: Product[],
  licenses: License[]
): Promise<string> => {
    if (!process.env.API_KEY) return "API 키가 없습니다.";

    const dataSummary = JSON.stringify({
      productCount: products.length,
      licenseCount: licenses.length,
      activeLicenses: licenses.filter(l => l.status === 'ACTIVE').length,
      revenueEstimate: licenses.reduce((acc, lic) => {
        const prod = products.find(p => p.id === lic.productId);
        return acc + (prod ? prod.price : 0);
      }, 0)
    });

    const prompt = `
      이 간단한 소프트웨어 판매 데이터를 분석해줘: ${dataSummary}.
      판매를 개선하거나 라이선스를 더 잘 관리하기 위한 전략적인 3가지 핵심 포인트를 **한국어**로 작성해줘. 
      장황하지 않게 간결하게 작성해줘.
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      return response.text || "분석 결과를 사용할 수 없습니다.";
    } catch (error) {
      return "분석에 실패했습니다.";
    }
};

export const parseDepositText = async (text: string): Promise<{ name: string; amount: number; bank: string } | null> => {
  if (!process.env.API_KEY) return null;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extract the sender name (depositor), amount (as a number), and bank name from this Korean bank deposit SMS/Notification text.
      Text: "${text}"
      
      Examples:
      Input: "[카카오뱅크] 홍길동님 50,000원 입금" -> Output: {"name": "홍길동", "amount": 50000, "bank": "카카오뱅크"}
      Input: "KB국민 1/2 10:00 123-*** 김철수 25000원" -> Output: {"name": "김철수", "amount": 25000, "bank": "KB국민"}
      Input: "입금 30,000원 (이영희)" -> Output: {"name": "이영희", "amount": 30000, "bank": "Unknown"}
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            bank: { type: Type.STRING },
          }
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    return null;
  } catch (error) {
    console.error("Gemini Parsing Error:", error);
    return null;
  }
};