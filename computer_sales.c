#include <stdio.h>

int main()
{
//int n;
double n,sp,bo,co,bs=1500;
printf("Please enter the no. of computers sold :\n ");
scanf("%lf", &n);
printf("Please enter the price of computers :\n ");
scanf("%lf", &sp);
bo = 200*n;
co = 0.02*n*sp;
bs =bs+bo+co;
printf("Bonus :%lf\n", bo);
printf("Commission :%lf\n", co);
printf("Gross salary :%lf\n", bs);
}